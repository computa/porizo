import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSpend, emptyStore } from './spend-store.mjs';

const baseDay = (extra = {}) => ({
  impressions: 100,
  taps: 5,
  installs: 1,
  spend: 1.5,
  avg_cpt: 0.3,
  ...extra,
});

const pullFixture = (date) => ({
  pulled_at: '2026-05-13T12:00:00Z',
  campaigns: [
    {
      campaign_id: '2143835551',
      name: 'Probe US Painkiller',
      date,
      ...baseDay({ spend: 18.4 }),
    },
  ],
  keywords: [
    {
      campaign_id: '2143835551',
      keyword_id: '51234567',
      term: 'song for mom',
      match_type: 'BROAD',
      date,
      ...baseDay({ spend: 3.2 }),
    },
  ],
});

test('emptyStore returns versioned skeleton', () => {
  const s = emptyStore();
  assert.equal(s.schema_version, '1.0');
  assert.deepEqual(s.campaigns, {});
  assert.deepEqual(s.keywords, {});
});

test('merge inserts new campaigns and keywords with first_seen', () => {
  const store = emptyStore();
  const merged = mergeSpend(store, pullFixture('2026-05-12'));

  const camp = merged.campaigns['2143835551'];
  assert.equal(camp.name, 'Probe US Painkiller');
  assert.equal(camp.first_seen, '2026-05-12');
  assert.equal(camp.daily['2026-05-12'].spend, 18.4);

  const kw = merged.keywords['2143835551:51234567'];
  assert.equal(kw.term, 'song for mom');
  assert.equal(kw.first_seen, '2026-05-12');
  assert.equal(kw.daily['2026-05-12'].spend, 3.2);
});

test('merge adds new days without losing old days', () => {
  let store = emptyStore();
  store = mergeSpend(store, pullFixture('2026-05-12'));
  store = mergeSpend(store, pullFixture('2026-05-13'));

  const camp = store.campaigns['2143835551'];
  assert.equal(Object.keys(camp.daily).length, 2);
  assert.equal(camp.daily['2026-05-12'].spend, 18.4);
  assert.equal(camp.daily['2026-05-13'].spend, 18.4);
  assert.equal(camp.first_seen, '2026-05-12', 'first_seen should not change on later pulls');
});

test('merge overwrites existing day when Apple revises numbers', () => {
  let store = emptyStore();
  store = mergeSpend(store, pullFixture('2026-05-12'));

  const revised = pullFixture('2026-05-12');
  revised.campaigns[0].spend = 22.0;
  store = mergeSpend(store, revised);

  assert.equal(
    store.campaigns['2143835551'].daily['2026-05-12'].spend,
    22.0,
    'revised spend should overwrite original',
  );
});

test('merge preserves days outside the new pull window', () => {
  let store = emptyStore();
  store = mergeSpend(store, pullFixture('2026-04-01'));
  store = mergeSpend(store, pullFixture('2026-05-13'));

  const camp = store.campaigns['2143835551'];
  assert.ok(camp.daily['2026-04-01'], 'old day still present');
  assert.ok(camp.daily['2026-05-13'], 'new day present');
});

test('merge updates updated_at timestamp', () => {
  const store = emptyStore();
  const pull = pullFixture('2026-05-12');
  pull.pulled_at = '2026-05-13T15:30:00Z';
  const merged = mergeSpend(store, pull);
  assert.equal(merged.updated_at, '2026-05-13T15:30:00Z');
});

test('merge handles missing campaign name (preserve existing)', () => {
  let store = emptyStore();
  store = mergeSpend(store, pullFixture('2026-05-12'));

  const pull = pullFixture('2026-05-13');
  delete pull.campaigns[0].name;
  store = mergeSpend(store, pull);

  assert.equal(
    store.campaigns['2143835551'].name,
    'Probe US Painkiller',
    'should keep existing name when pull omits it',
  );
});

test('merge ignores rows with zero impressions+taps+spend', () => {
  const store = emptyStore();
  const pull = pullFixture('2026-05-12');
  pull.keywords.push({
    campaign_id: '2143835551',
    keyword_id: '99999999',
    term: 'dead keyword',
    match_type: 'BROAD',
    date: '2026-05-12',
    impressions: 0,
    taps: 0,
    installs: 0,
    spend: 0,
    avg_cpt: 0,
  });
  const merged = mergeSpend(store, pull);
  assert.equal(
    merged.keywords['2143835551:99999999'],
    undefined,
    'zero-row keywords should not be persisted',
  );
});
