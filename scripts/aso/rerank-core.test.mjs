import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateAsaRows,
  classifyAction,
  mergeSignals,
  normalizeTerm,
  packKeywordsField,
  parseAsaRows,
  parseCsv,
  scoreKeyword,
} from './rerank-core.mjs';

function bankFixture() {
  return {
    schema_version: '1.0',
    last_reviewed: '2026-05-11',
    live_surfaces: { keywords: 'old,keywords' },
    shipping_target_count: 10,
    scoring: {
      intent_bonus: { painkiller: 10, brand: 15, category: 5, vitamin: 0 },
      intent_multiplier: { painkiller: 1.3, brand: 1.2, category: 1, vitamin: 0.7 },
    },
    keywords: [
      {
        term: 'gift song',
        tier: 1,
        intent_class: 'painkiller',
        status: 'testing',
        char_count: 9,
        external: {},
        asa: {},
        asc_organic: {},
        backend: {},
        effectiveness_score: 0,
        history: [],
      },
      {
        term: 'personalized gifts',
        tier: 2,
        intent_class: 'painkiller',
        status: 'testing',
        char_count: 18,
        external: {},
        asa: {},
        asc_organic: {},
        backend: {},
        effectiveness_score: 0,
        history: [],
      },
    ],
    review_log: [],
  };
}

test('normalizeTerm lowercases and collapses whitespace', () => {
  assert.equal(normalizeTerm('  Gift   Song  '), 'gift song');
});

test('parseCsv handles quoted commas and escaped quotes', () => {
  const rows = parseCsv('Keyword,Notes\n"song, gift","say ""hello"""\n');
  assert.deepEqual(rows, [{ Keyword: 'song, gift', Notes: 'say "hello"' }]);
});

test('parseAsaRows maps historical ASA CSV columns', () => {
  const rows = parseAsaRows('Keyword,Match Type,Max CPT,Impressions,Taps,Conversions,Spend,Avg CPT\nGift Song,EXACT,1.80,55,5,3,1.21,0.24\n');
  assert.equal(rows[0].term, 'gift song');
  assert.equal(rows[0].match_type, 'EXACT');
  assert.equal(rows[0].max_cpt, 1.8);
  assert.equal(rows[0].installs, 3);
  assert.equal(rows[0].spend, 1.21);
});

test('aggregateAsaRows combines duplicate keyword rows and preserves exact match', () => {
  const rows = aggregateAsaRows([
    { term: 'gift song', match_type: 'BROAD', max_cpt: 1, impressions: 10, taps: 1, installs: 0, spend: 0.5, cpt: 0.5 },
    { term: 'gift song', match_type: 'EXACT', max_cpt: 2, impressions: 20, taps: 2, installs: 1, spend: 1.0, cpt: 0.5 },
  ]);
  const row = rows.get('gift song');
  assert.equal(row.match_type, 'EXACT');
  assert.equal(row.max_cpt, 2);
  assert.equal(row.impressions, 30);
  assert.equal(row.taps, 3);
  assert.equal(row.installs, 1);
  assert.equal(row.spend, 1.5);
});

test('scoreKeyword excludes installs-without-taps anomalies from ranking', () => {
  const bank = bankFixture();
  const score = scoreKeyword({
    term: 'music gift',
    intent_class: 'category',
    asa: { impressions: 100, taps: 0, installs: 1, spend: 0 },
    asc_organic: {},
    external: {},
  }, bank);
  assert.equal(score, 0);
});

test('classifyAction distinguishes volume capped from bid pressure', () => {
  assert.equal(
    classifyAction({ asa: { impressions: 20, taps: 2, installs: 1, spend: 0.1, cpt: 0.05, max_cpt: 1.8, match_type: 'EXACT' } }),
    'VOLUME_CAPPED',
  );
  assert.equal(
    classifyAction({ asa: { impressions: 20, taps: 2, installs: 1, spend: 3.2, cpt: 1.6, max_cpt: 1.8, match_type: 'EXACT' } }),
    'BID_UP',
  );
});

test('packKeywordsField respects 100 character App Store limit', () => {
  const packed = packKeywordsField([
    { term: 'birthday gift ideas', status: 'testing', effectiveness_score: 100, asa: { taps: 4, installs: 2 } },
    { term: 'personalized gift', status: 'testing', effectiveness_score: 90, asa: { taps: 3, installs: 1 } },
    { term: 'a very long keyword phrase that will not fit after the other terms', status: 'testing', effectiveness_score: 80, asa: { taps: 4, installs: 1 } },
    { term: 'gift song', status: 'testing', effectiveness_score: 70, asa: { taps: 6, installs: 3 } },
  ]);
  assert.ok(packed.chars <= 100);
  assert.equal(packed.string, 'birthday gift ideas,personalized gift,gift song');
});

test('packKeywordsField requires enough confidence for shipping keywords', () => {
  const packed = packKeywordsField([
    { term: 'personalized gift', status: 'testing', effectiveness_score: 100, asa: { impressions: 23, taps: 1, installs: 1 } },
    { term: 'birthday gift ideas', status: 'testing', effectiveness_score: 90, asa: { impressions: 177, taps: 4, installs: 2 } },
    { term: 'gift song', status: 'testing', effectiveness_score: 80, asa: { impressions: 62, taps: 6, installs: 3 } },
  ]);
  assert.equal(packed.string, 'birthday gift ideas,gift song');
});

test('mergeSignals updates existing keywords and seeds ASA discovery candidates', () => {
  const { bank, report } = mergeSignals(bankFixture(), {
    date: '2026-05-15',
    note: 'test run',
    asaRows: [
      { term: 'gift song', match_type: 'EXACT', max_cpt: 1.8, impressions: 55, taps: 5, installs: 3, spend: 1.21, cpt: 0.24 },
      { term: 'custom gift', match_type: 'BROAD', max_cpt: 1.8, impressions: 154, taps: 2, installs: 1, spend: 1.92, cpt: 0.96 },
    ],
  });

  assert.equal(report.asaRowsMerged, 2);
  assert.equal(report.asaRowsDiscovered, 1);
  assert.deepEqual(report.discoveryCandidates, ['custom gift']);
  assert.equal(bank.last_reviewed, '2026-05-15');
  assert.equal(bank.review_log.at(-1).keywords_field_chars, report.packed.chars);
  assert.equal(bank.keywords.find((k) => k.term === 'custom gift').status, 'testing');
  assert.ok(bank.keywords.find((k) => k.term === 'gift song').effectiveness_score > 0);
});
