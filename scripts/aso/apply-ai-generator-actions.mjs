#!/usr/bin/env node
import {
  amount,
  createCampaignNegatives,
  createKeywordPayload,
  findAdGroups,
  findTargetingKeywords,
  groupByAdGroup,
  keywordKey,
  normalizeMatchType,
  normalizeTerm,
  pauseKeywordPayload,
  runApplyMain,
  applyMainErrorHandler,
} from './apply-lib.mjs';

const CAMPAIGNS = {
  category: '2143696873',
  probe: '2143835551',
};

const AI_GENERATOR_ADGROUP_NAME = 'AI-Generator Lane';
const AI_GENERATOR_DEFAULT_BID = 1.5;
const AI_GENERATOR_KEYWORDS = [
  ['ai music generator', 1.5],
  ['ai song generator', 1.5],
  ['ai song maker', 1.5],
  ['ai music maker', 1.5],
  ['ai song creator', 1.2],
  ['ai music gift', 1.2],
  ['ai song app', 1.0],
  ['ai music app', 1.0],
  ['song generator app', 1.0],
  ['ai text to song', 1.0],
  ['ai song for birthday', 1.2],
  ['ai song for anniversary', 1.2],
  ['ai song for wedding', 1.2],
  ['birthday song generator', 1.2],
  ['gift song generator', 1.2],
];

const CAMPAIGN_NEGATIVES = [
  ['karaoke', 'BROAD'],
  ['remix', 'BROAD'],
  ['cover song', 'BROAD'],
  ['free music download', 'BROAD'],
  ['mp3 download', 'BROAD'],
  ['youtube music', 'BROAD'],
  ['spotify', 'BROAD'],
];

const LOSER_KEYWORDS = [
  { campaignId: CAMPAIGNS.category, term: 'personalized gifts', matchType: 'BROAD' },
  { campaignId: CAMPAIGNS.category, term: 'meaningful gift', matchType: 'BROAD' },
  { campaignId: CAMPAIGNS.probe, term: 'my voice song app', matchType: 'BROAD' },
  { campaignId: CAMPAIGNS.probe, term: 'i miss you song', matchType: 'BROAD' },
];

const AI_GENERATOR_MAX_TERMS = 20;

function help() {
  console.log(`Usage: node scripts/aso/apply-ai-generator-actions.mjs [--execute]

Applies the 2026-05-20 ASA AI-generator lane pivot:
  1. Pause four zero-install paid losers.
  2. Create or reuse "${AI_GENERATOR_ADGROUP_NAME}" in Probe US Painkiller.
  3. Add the exact-match AI-generator keyword payload with per-keyword bids.
  4. Add campaign-level broad negatives to block karaoke/download leakage.

Default is dry-run. Pass --execute to mutate Apple Ads.
`);
}

function updateKeywordBidPayload(keyword, bid) {
  return {
    id: Number(keyword.id),
    bidAmount: { amount: bid.toFixed(2), currency: keyword.bidAmount?.currency ?? 'USD' },
  };
}

function asaTimestamp() {
  return new Date().toISOString().replace('Z', '');
}

function createAdGroupPayload({ orgId }) {
  return {
    name: AI_GENERATOR_ADGROUP_NAME,
    cpaGoal: null,
    startTime: asaTimestamp(),
    endTime: null,
    automatedKeywordsOptIn: false,
    defaultBidAmount: { amount: AI_GENERATOR_DEFAULT_BID.toFixed(2), currency: 'USD' },
    biddingStrategy: 'MANUAL_CPT',
    pricingModel: 'CPC',
    status: 'ENABLED',
    orgId: Number(orgId),
    targetingDimensions: {
      age: null,
      gender: null,
      country: null,
      adminArea: null,
      locality: null,
      deviceClass: {
        included: ['IPHONE', 'IPAD'],
      },
      daypart: null,
      appDownloaders: null,
      appCategories: null,
    },
  };
}

async function ensureAiGeneratorAdGroup(client, cfg, { execute }) {
  const adGroups = await findAdGroups(client, CAMPAIGNS.probe);
  const existing = adGroups.find((group) => normalizeTerm(group.name) === normalizeTerm(AI_GENERATOR_ADGROUP_NAME));
  if (existing) return { adGroup: existing, payload: null, created: false };

  const payload = createAdGroupPayload({ orgId: cfg.orgId });
  if (!execute) return { adGroup: null, payload, created: false };

  const json = await client('POST', `/campaigns/${CAMPAIGNS.probe}/adgroups`, payload);
  if (!json.data?.id) {
    throw new Error(`ASA did not return an ad group id: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return { adGroup: json.data, payload, created: true };
}

function findLoserKeywords(keywordsByCampaign) {
  const found = [];
  const missing = [];
  for (const target of LOSER_KEYWORDS) {
    const keywords = keywordsByCampaign.get(String(target.campaignId)) ?? [];
    const keyword = keywords.find(
      (kw) =>
        normalizeTerm(kw.text) === normalizeTerm(target.term) &&
        normalizeMatchType(kw.matchType) === normalizeMatchType(target.matchType) &&
        kw.status === 'ACTIVE' &&
        !kw.deleted,
    );
    if (keyword) found.push({ ...keyword, campaignId: target.campaignId });
    else missing.push(target);
  }
  return { found, missing };
}

function planAiGeneratorKeywords(probeKeywords, adGroupId) {
  if (AI_GENERATOR_KEYWORDS.length > AI_GENERATOR_MAX_TERMS) {
    throw new Error(
      `Refusing to apply ${AI_GENERATOR_KEYWORDS.length} AI generator terms; max safety limit is ${AI_GENERATOR_MAX_TERMS}`,
    );
  }
  const active = probeKeywords.filter((kw) => kw.status === 'ACTIVE' && !kw.deleted);
  const exactByKey = new Map(
    active
      .filter((kw) => normalizeMatchType(kw.matchType) === 'EXACT')
      .map((kw) => [keywordKey(kw), kw]),
  );
  const missingByAdGroup = new Map([[String(adGroupId), []]]);
  const existingToRaise = [];
  const alreadyExact = [];

  for (const [rawTerm, bid] of AI_GENERATOR_KEYWORDS) {
    const term = normalizeTerm(rawTerm);
    const existing = exactByKey.get(`${term}::EXACT`);
    if (existing) {
      alreadyExact.push(existing);
      if (amount(existing.bidAmount) < bid) existingToRaise.push({ keyword: existing, bid });
    } else {
      missingByAdGroup.get(String(adGroupId)).push({ term, bid, currency: 'USD' });
    }
  }

  return { alreadyExact, existingToRaise, missingByAdGroup };
}

async function pauseTargetingKeywords(client, keywords, { execute }) {
  const planned = [];
  const byCampaign = new Map();
  for (const keyword of keywords) {
    const campaignId = String(keyword.campaignId);
    if (!byCampaign.has(campaignId)) byCampaign.set(campaignId, []);
    byCampaign.get(campaignId).push(keyword);
  }
  for (const [campaignId, campaignKeywords] of byCampaign) {
    for (const [adGroupId, group] of groupByAdGroup(campaignKeywords)) {
      const payload = group.map(pauseKeywordPayload);
      planned.push({ campaignId, adGroupId, keywords: group, payload });
      if (execute && payload.length) {
        await client('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, payload);
      }
    }
  }
  return planned;
}

async function createTargetingKeywords(client, campaignId, termsByAdGroup, { execute }) {
  const planned = [];
  for (const [adGroupId, terms] of termsByAdGroup) {
    const payload = terms.map((item) => createKeywordPayload(item.term, item.bid, item.currency));
    planned.push({ campaignId, adGroupId, payload });
    if (execute && payload.length) {
      await client('POST', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, payload);
    }
  }
  return planned;
}

async function updateKeywordBids(client, campaignId, items, { execute }) {
  const planned = [];
  const byBid = new Map();
  for (const item of items) {
    const bidKey = item.bid.toFixed(2);
    if (!byBid.has(bidKey)) byBid.set(bidKey, []);
    byBid.get(bidKey).push(item.keyword);
  }
  for (const [bidKey, keywords] of byBid) {
    for (const [adGroupId, group] of groupByAdGroup(keywords)) {
      const bid = Number(bidKey);
      const payload = group.map((kw) => updateKeywordBidPayload(kw, bid));
      planned.push({ campaignId, adGroupId, bid, payload });
      if (execute && payload.length) {
        await client('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, payload);
      }
    }
  }
  return planned;
}

async function plan({ client, execute, args, cfg }) {
  const keywordsByCampaign = new Map();
  for (const campaignId of [CAMPAIGNS.category, CAMPAIGNS.probe]) {
    keywordsByCampaign.set(String(campaignId), await findTargetingKeywords(client, campaignId));
  }

  const loserPlan = findLoserKeywords(keywordsByCampaign);
  const pauses = await pauseTargetingKeywords(client, loserPlan.found, args);
  console.log(`Paid loser pauses: ${loserPlan.found.length}/${LOSER_KEYWORDS.length} active keywords to pause`);
  for (const group of pauses) {
    console.log(`  campaign ${group.campaignId} adGroup ${group.adGroupId}: ${group.payload.length} keywords`);
    for (const kw of group.keywords) console.log(`    [${kw.text}] ${kw.matchType}`);
  }
  for (const target of loserPlan.missing) {
    console.log(`  already paused/missing: campaign ${target.campaignId} [${target.term}] ${target.matchType}`);
  }

  const adGroupResult = await ensureAiGeneratorAdGroup(client, cfg, args);
  const adGroupId = adGroupResult.adGroup?.id ?? 'DRY_RUN_ADGROUP';
  if (adGroupResult.adGroup) {
    console.log(
      `AI-generator ad group: ${adGroupResult.created ? 'created' : 'using existing'} ` +
        `"${AI_GENERATOR_ADGROUP_NAME}" (${adGroupId})`,
    );
  } else {
    console.log(`AI-generator ad group: would create "${AI_GENERATOR_ADGROUP_NAME}" in campaign ${CAMPAIGNS.probe}`);
  }

  const probeKeywords = adGroupResult.created
    ? await findTargetingKeywords(client, CAMPAIGNS.probe)
    : keywordsByCampaign.get(String(CAMPAIGNS.probe));
  const keywordPlan = planAiGeneratorKeywords(probeKeywords, adGroupId);
  const createCount = [...keywordPlan.missingByAdGroup.values()].reduce((sum, items) => sum + items.length, 0);
  console.log(
    `AI-generator exact keywords: ${AI_GENERATOR_KEYWORDS.length} terms ` +
      `(${keywordPlan.alreadyExact.length} already exact, ${createCount} to create)`,
  );
  console.log(`  target campaign ${CAMPAIGNS.probe}, adGroup ${adGroupId}`);

  const creates = await createTargetingKeywords(client, CAMPAIGNS.probe, keywordPlan.missingByAdGroup, args);
  for (const group of creates) {
    console.log(`  adGroup ${group.adGroupId}: ${group.payload.length} exact keywords to create`);
    for (const kw of group.payload) console.log(`    [${kw.text}] $${kw.bidAmount.amount}`);
  }

  const updates = await updateKeywordBids(client, CAMPAIGNS.probe, keywordPlan.existingToRaise, args);
  console.log(`AI-generator bid updates: ${keywordPlan.existingToRaise.length} exact keywords to planned max CPT`);
  for (const group of updates) {
    console.log(`  adGroup ${group.adGroupId}: ${group.payload.length} keywords to $${group.bid.toFixed(2)}`);
  }

  const negatives = await createCampaignNegatives(client, CAMPAIGNS.probe, CAMPAIGN_NEGATIVES, args);
  console.log(
    `Probe campaign broad leakage negatives: ${negatives.created.length} to create (${negatives.existing} already present)`,
  );
  for (const kw of negatives.created) console.log(`  [${kw.text}] ${kw.matchType}`);

  if (!execute) {
    console.log('\nDry-run only. Re-run with --execute to apply these Apple Ads changes.');
  }
}

runApplyMain({
  executeBanner: '🚨 EXECUTING Apple Ads AI generator actions',
  dryRunBanner: '🧪 Dry-run Apple Ads AI generator actions',
  plan,
  help,
}).catch(applyMainErrorHandler('✖ apply-ai-generator-actions'));
