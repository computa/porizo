#!/usr/bin/env node
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ROOT,
  amount,
  createCampaignNegatives,
  createKeywordPayload,
  findTargetingKeywords,
  groupByAdGroup,
  keywordKey,
  normalizeMatchType,
  normalizeTerm,
  runApplyMain,
  applyMainErrorHandler,
} from './apply-lib.mjs';

const KEYWORD_BANK_PATH = path.join(ROOT, 'marketing/appstore/aso/keywords.json');

const CAMPAIGNS = {
  category: '2143696873',
  discovery: '2143698138',
  probe: '2143835551',
};

const PROBE_TARGET_BID = 1.5;
const PROBE_MAX_KEYWORDS = 60;
const WASTE_EXACT_NEGATIVES = ['anniversary gift', 'personalized gifts', 'meaningful gift'];
const CATEGORY_WINNER_TERMS = ['gift song', 'birthday gift ideas', 'birthday gift'];
const CATEGORY_WINNER_BID = 3.0;
const CATEGORY_GRADUATION_MAX_TERMS = 10;

function help() {
  console.log(`Usage: node scripts/aso/apply-painkiller-actions.mjs [--execute]

Applies the 2026-05-15 painkiller campaign actions:
  1. Raise active Probe US Painkiller targeting keywords to $${PROBE_TARGET_BID.toFixed(2)} max CPT.
  2. Ensure exact waste negatives in Category and Probe campaigns.
  3. Ensure proven Category exact winners have at least $${CATEGORY_WINNER_BID.toFixed(2)} max CPT.
  4. Graduate rerank MATCH_TYPE_GRADUATION terms into Category exact match and add Discovery exact negatives.

Default is dry-run. Pass --execute to mutate Apple Ads.
`);
}

async function loadKeywordBank() {
  const raw = await fs.readFile(KEYWORD_BANK_PATH, 'utf8');
  return JSON.parse(raw);
}

function keywordPayload(keyword, bid) {
  return {
    id: Number(keyword.id),
    text: keyword.text,
    matchType: keyword.matchType,
    status: keyword.status,
    bidAmount: { amount: bid.toFixed(2), currency: keyword.bidAmount?.currency ?? 'USD' },
  };
}

async function updateKeywords(client, campaignId, keywords, bid, { execute }) {
  const planned = [];
  for (const [adGroupId, group] of groupByAdGroup(keywords)) {
    const payload = group.map((kw) => keywordPayload(kw, bid));
    planned.push({ campaignId, adGroupId, count: payload.length, payload });
    if (execute && payload.length) {
      await client('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, payload);
    }
  }
  return planned;
}

async function createTargetingKeywords(client, campaignId, termsByAdGroup, bid, { execute }) {
  const planned = [];
  for (const [adGroupId, terms] of termsByAdGroup) {
    const currency = terms.find((item) => item.currency)?.currency ?? 'USD';
    const payload = terms.map((item) => createKeywordPayload(item.term, bid, item.currency ?? currency));
    planned.push({ campaignId, adGroupId, count: payload.length, payload });
    if (execute && payload.length) {
      await client('POST', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, payload);
    }
  }
  return planned;
}

function categoryGraduationTerms(bank) {
  const terms = new Map();
  for (const term of CATEGORY_WINNER_TERMS) {
    terms.set(normalizeTerm(term), normalizeTerm(term));
  }
  for (const keyword of bank.keywords ?? []) {
    if (keyword.status === 'excluded') continue;
    if (!['MATCH_TYPE_GRADUATION', 'PROTECT_AND_SCALE'].includes(keyword.action)) continue;
    const term = normalizeTerm(keyword.term);
    if (term) terms.set(term, term);
  }
  return [...terms.values()];
}

function planCategoryGraduations(categoryKeywords, terms, bid) {
  if (terms.length > CATEGORY_GRADUATION_MAX_TERMS) {
    throw new Error(
      `Refusing to graduate ${terms.length} terms; max safety limit is ${CATEGORY_GRADUATION_MAX_TERMS}`,
    );
  }

  const activeKeywords = categoryKeywords.filter((kw) => kw.status === 'ACTIVE' && !kw.deleted);
  const exactByKey = new Map(
    activeKeywords
      .filter((kw) => normalizeMatchType(kw.matchType) === 'EXACT')
      .map((kw) => [keywordKey(kw), kw]),
  );
  const sourceByTerm = new Map();
  for (const kw of activeKeywords) {
    const term = normalizeTerm(kw.text);
    if (!sourceByTerm.has(term) || normalizeMatchType(kw.matchType) === 'BROAD') {
      sourceByTerm.set(term, kw);
    }
  }
  const fallbackSource =
    CATEGORY_WINNER_TERMS.map((term) => exactByKey.get(`${normalizeTerm(term)}::EXACT`)).find(Boolean) ??
    activeKeywords.find((kw) => normalizeMatchType(kw.matchType) === 'EXACT') ??
    activeKeywords[0];

  const missingByAdGroup = new Map();
  const existingToRaise = [];
  const alreadyExact = [];

  for (const term of terms) {
    const exact = exactByKey.get(`${normalizeTerm(term)}::EXACT`);
    if (exact) {
      alreadyExact.push(exact);
      if (amount(exact.bidAmount) < bid) existingToRaise.push(exact);
      continue;
    }
    const source = sourceByTerm.get(normalizeTerm(term)) ?? fallbackSource;
    if (!source?.adGroupId) {
      throw new Error(`Cannot infer a Category ad group for exact keyword "${term}"`);
    }
    const adGroupId = String(source.adGroupId);
    if (!missingByAdGroup.has(adGroupId)) missingByAdGroup.set(adGroupId, []);
    missingByAdGroup.get(adGroupId).push({
      term,
      currency: source.bidAmount?.currency ?? 'USD',
    });
  }

  return { alreadyExact, existingToRaise, missingByAdGroup };
}

async function plan({ client, execute, args }) {
  const probeKeywords = await findTargetingKeywords(client, CAMPAIGNS.probe);
  const activeProbe = probeKeywords.filter(
    (kw) => kw.status === 'ACTIVE' && !kw.deleted && amount(kw.bidAmount) < PROBE_TARGET_BID,
  );
  if (activeProbe.length > PROBE_MAX_KEYWORDS) {
    throw new Error(`Refusing to update ${activeProbe.length} probe keywords; max safety limit is ${PROBE_MAX_KEYWORDS}`);
  }
  const probeUpdates = await updateKeywords(client, CAMPAIGNS.probe, activeProbe, PROBE_TARGET_BID, args);
  console.log(`Probe bid updates: ${activeProbe.length}/${probeKeywords.length} active keywords to $${PROBE_TARGET_BID.toFixed(2)}`);
  for (const group of probeUpdates) {
    console.log(`  adGroup ${group.adGroupId}: ${group.count} keywords`);
  }

  const categoryKeywords = await findTargetingKeywords(client, CAMPAIGNS.category);
  const bank = await loadKeywordBank();
  const graduationTerms = categoryGraduationTerms(bank);
  const graduationPlan = planCategoryGraduations(categoryKeywords, graduationTerms, CATEGORY_WINNER_BID);
  const exactCreates = await createTargetingKeywords(
    client,
    CAMPAIGNS.category,
    graduationPlan.missingByAdGroup,
    CATEGORY_WINNER_BID,
    args,
  );
  console.log(
    `Category exact graduations: ${graduationTerms.length} terms ` +
      `(${graduationPlan.alreadyExact.length} already exact, ` +
      `${[...graduationPlan.missingByAdGroup.values()].reduce((sum, items) => sum + items.length, 0)} to create)`,
  );
  for (const group of exactCreates) {
    console.log(`  adGroup ${group.adGroupId}: ${group.count} exact keywords`);
    for (const kw of group.payload) {
      console.log(`    [${kw.text}]`);
    }
  }

  const winnerUpdates = await updateKeywords(
    client,
    CAMPAIGNS.category,
    graduationPlan.existingToRaise,
    CATEGORY_WINNER_BID,
    args,
  );
  console.log(`Category winner bid updates: ${graduationPlan.existingToRaise.length} exact keywords to at least $${CATEGORY_WINNER_BID.toFixed(2)}`);
  for (const group of winnerUpdates) {
    console.log(`  adGroup ${group.adGroupId}: ${group.count} keywords`);
  }

  const negativeTargets = [CAMPAIGNS.category, CAMPAIGNS.probe];
  for (const campaignId of negativeTargets) {
    const result = await createCampaignNegatives(client, campaignId, WASTE_EXACT_NEGATIVES, { execute, defaultMatchType: 'EXACT' });
    console.log(
      `Campaign ${campaignId} exact negatives: ${result.created.length} to create (${result.existing} already present)`,
    );
    for (const kw of result.created) {
      console.log(`  [${kw.text}]`);
    }
  }

  const discoveryGraduationNegatives = await createCampaignNegatives(client, CAMPAIGNS.discovery, graduationTerms, { execute, defaultMatchType: 'EXACT' });
  console.log(
    `Discovery exact negatives for Category winners: ${discoveryGraduationNegatives.created.length} to create ` +
      `(${discoveryGraduationNegatives.existing} already present)`,
  );
  for (const kw of discoveryGraduationNegatives.created) {
    console.log(`  [${kw.text}]`);
  }

  if (!execute) {
    console.log('\nDry-run only. Re-run with --execute to apply these Apple Ads changes.');
  }
}

runApplyMain({
  executeBanner: '🚨 EXECUTING Apple Ads painkiller actions',
  dryRunBanner: '🧪 Dry-run Apple Ads painkiller actions',
  plan,
  help,
}).catch(applyMainErrorHandler('✖ apply-painkiller-actions'));
