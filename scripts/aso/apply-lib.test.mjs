import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseArgs,
  selector,
  normalizeMatchType,
  keywordKey,
  amount,
  createKeywordPayload,
  pauseKeywordPayload,
  capKeywordPayload,
  createCampaignNegatives,
} from './apply-lib.mjs';

test('parseArgs reads --execute and --help/-h flags', () => {
  assert.deepEqual(parseArgs([]), { execute: false, help: false });
  assert.deepEqual(parseArgs(['--execute']), { execute: true, help: false });
  assert.deepEqual(parseArgs(['--help']), { execute: false, help: true });
  assert.deepEqual(parseArgs(['-h']), { execute: false, help: true });
  assert.deepEqual(parseArgs(['--execute', '--help']), { execute: true, help: true });
  assert.deepEqual(parseArgs(['--unknown']), { execute: false, help: false });
});

test('selector builds the standard non-deleted find selector', () => {
  assert.deepEqual(selector(), {
    pagination: { offset: 0, limit: 1000 },
    orderBy: [{ field: 'id', sortOrder: 'ASCENDING' }],
    conditions: [{ field: 'deleted', operator: 'EQUALS', values: ['false'] }],
  });
  assert.equal(selector({ limit: 25 }).pagination.limit, 25);
});

test('normalizeMatchType upper-cases and tolerates nullish input', () => {
  assert.equal(normalizeMatchType('exact'), 'EXACT');
  assert.equal(normalizeMatchType('Broad'), 'BROAD');
  assert.equal(normalizeMatchType(null), '');
  assert.equal(normalizeMatchType(undefined), '');
});

test('keywordKey normalizes term and match type into a stable key', () => {
  assert.equal(keywordKey({ text: '  Gift   Song ', matchType: 'exact' }), 'gift song::EXACT');
  assert.equal(keywordKey({ text: 'Birthday Gift', matchType: 'BROAD' }), 'birthday gift::BROAD');
});

test('amount coerces numbers, strings, and ASA money objects', () => {
  assert.equal(amount(1.5), 1.5);
  assert.equal(amount('2.25'), 2.25);
  assert.equal(amount({ amount: '3.00', currency: 'USD' }), 3);
  assert.equal(amount(null), 0);
  assert.equal(amount('not-a-number'), 0);
  assert.equal(amount({}), 0);
});

test('createKeywordPayload builds an EXACT keyword with a 2-decimal bid', () => {
  assert.deepEqual(createKeywordPayload('ai song generator', 1.5), {
    text: 'ai song generator',
    matchType: 'EXACT',
    bidAmount: { amount: '1.50', currency: 'USD' },
  });
  assert.deepEqual(createKeywordPayload('gift song', 3, 'GBP'), {
    text: 'gift song',
    matchType: 'EXACT',
    bidAmount: { amount: '3.00', currency: 'GBP' },
  });
});

test('pauseKeywordPayload preserves bidAmount and numeric id', () => {
  assert.deepEqual(pauseKeywordPayload({ id: '123', bidAmount: { amount: '1.00', currency: 'USD' } }), {
    id: 123,
    status: 'PAUSED',
    bidAmount: { amount: '1.00', currency: 'USD' },
  });
});

test('capKeywordPayload caps the bid and keeps the keyword currency', () => {
  assert.deepEqual(capKeywordPayload({ id: '9', bidAmount: { amount: '5.00', currency: 'GBP' } }, 1), {
    id: 9,
    bidAmount: { amount: '1.00', currency: 'GBP' },
  });
  assert.deepEqual(capKeywordPayload({ id: '9' }, 1), {
    id: 9,
    bidAmount: { amount: '1.00', currency: 'USD' },
  });
});

function makeNegativeClient(existing) {
  const sent = [];
  const client = async (method, urlPath, body) => {
    if (method === 'POST' && urlPath.endsWith('/negativekeywords/find')) {
      return { data: existing };
    }
    if (method === 'POST' && urlPath.endsWith('/negativekeywords/bulk')) {
      sent.push({ urlPath, body });
      return { data: body };
    }
    throw new Error(`unexpected call ${method} ${urlPath}`);
  };
  return { client, sent };
}

test('createCampaignNegatives tuple form normalizes term + match type', async () => {
  const { client, sent } = makeNegativeClient([
    { text: 'karaoke', matchType: 'BROAD' },
  ]);
  const result = await createCampaignNegatives(
    client,
    '111',
    [
      ['Karaoke', 'broad'],
      ['Cover Song', 'BROAD'],
    ],
    { execute: true },
  );
  assert.equal(result.existing, 1);
  assert.deepEqual(result.created, [{ text: 'cover song', matchType: 'BROAD' }]);
  assert.deepEqual(sent[0].body, [{ text: 'cover song', matchType: 'BROAD' }]);
});

test('createCampaignNegatives bare-term form keeps raw text + fixed match type', async () => {
  const { client, sent } = makeNegativeClient([
    { text: 'meaningful gift', matchType: 'EXACT' },
  ]);
  const result = await createCampaignNegatives(
    client,
    '222',
    ['anniversary gift', 'meaningful gift', 'personalized gifts'],
    { execute: true, defaultMatchType: 'EXACT' },
  );
  assert.equal(result.existing, 1);
  assert.deepEqual(result.created, [
    { text: 'anniversary gift', matchType: 'EXACT' },
    { text: 'personalized gifts', matchType: 'EXACT' },
  ]);
  assert.deepEqual(sent[0].body, result.created);
});

test('createCampaignNegatives does not POST in dry-run', async () => {
  const { client, sent } = makeNegativeClient([]);
  const result = await createCampaignNegatives(
    client,
    '333',
    ['spotify'],
    { execute: false, defaultMatchType: 'EXACT' },
  );
  assert.deepEqual(result.created, [{ text: 'spotify', matchType: 'EXACT' }]);
  assert.equal(sent.length, 0);
});
