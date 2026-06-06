import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findRank,
  searchStore,
  pullRanks,
  ranksToCsvRows,
  formatRankTable,
  PORIZO_APP_ID,
} from './rank-core.mjs';

function mockResults(names) {
  return names.map((n, i) => ({
    trackId: n === 'Porizo' ? PORIZO_APP_ID : 1000 + i,
    trackName: n,
  }));
}

function mockFetch(responseByCountry) {
  return async (url) => {
    const country = new URL(url).searchParams.get('country');
    const results = responseByCountry[country] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ resultCount: results.length, results }),
    };
  };
}

test('findRank matches by trackId', () => {
  const results = mockResults(['A', 'B', 'Porizo', 'C']);
  assert.equal(findRank(results, { appId: PORIZO_APP_ID }), 3);
});

test('findRank matches by name substring when id differs', () => {
  const results = [{ trackId: 1, trackName: 'X' }, { trackId: 2, trackName: 'Porizo: Song Gift' }];
  assert.equal(findRank(results, { appId: 999, nameMatch: 'porizo' }), 2);
});

test('findRank returns null when absent', () => {
  assert.equal(findRank(mockResults(['A', 'B']), { appId: PORIZO_APP_ID }), null);
});

test('searchStore reports position, total, and top app', async () => {
  const fetchImpl = mockFetch({ us: mockResults(['Top', 'Porizo', 'C']) });
  const hit = await searchStore({ term: 'song gift', country: 'us', fetchImpl });
  assert.deepEqual(hit, { position: 2, total: 3, indexed: true, topApp: 'Top' });
});

test('searchStore retries on throttle then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: mockResults(['Porizo']) }) };
  };
  const hit = await searchStore({ term: 'x', country: 'us', fetchImpl, retries: 2 });
  assert.equal(calls, 2);
  assert.equal(hit.position, 1);
});

test('pullRanks builds a row per keyword × country and records not-indexed', async () => {
  const fetchImpl = mockFetch({
    us: mockResults(['A', 'Porizo']),
    au: mockResults(['A', 'B', 'C']), // Porizo absent in AU
  });
  const pull = await pullRanks({
    keywords: ['song gift'],
    countries: ['us', 'au'],
    fetchImpl,
    sleepMs: 0,
  });
  assert.equal(pull.rows.length, 2);
  const us = pull.rows.find((r) => r.country === 'us');
  const au = pull.rows.find((r) => r.country === 'au');
  assert.equal(us.position, 2);
  assert.equal(us.indexed, true);
  assert.equal(au.position, null);
  assert.equal(au.indexed, false);
});

test('ranksToCsvRows shapes rows for the CSV headers', async () => {
  const fetchImpl = mockFetch({ us: mockResults(['A', 'Porizo']) });
  const pull = await pullRanks({ keywords: ['song gift'], countries: ['us'], fetchImpl, sleepMs: 0 });
  const [row] = ranksToCsvRows(pull);
  assert.equal(row.Keyword, 'song gift');
  assert.equal(row.Country, 'US');
  assert.equal(row.Rank, 2);
  assert.equal(row.Indexed, 'yes');
  assert.equal(row['Top App'], 'A');
});

test('formatRankTable renders a keyword row with per-country cells', async () => {
  const fetchImpl = mockFetch({ us: mockResults(['A', 'Porizo']), au: mockResults(['A']) });
  const pull = await pullRanks({ keywords: ['song gift'], countries: ['us', 'au'], fetchImpl, sleepMs: 0 });
  const table = formatRankTable(pull);
  assert.match(table, /song gift/);
  assert.match(table, /2\/2/); // US: #2 of 2
  assert.match(table, /—\/1/); // AU: absent of 1
});
