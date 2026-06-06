#!/usr/bin/env node
import {
  amount,
  capKeywordPayload,
  findAdGroups,
  findTargetingKeywords,
  pauseKeywordPayload,
  runApplyMain,
  applyMainErrorHandler,
  DRY_RUN_TRAILER,
} from './apply-lib.mjs';

const CAMPAIGNS = {
  category: '2143696873',
  brand: '2143697607',
  discovery: '2143698138',
  mothersDay: '2143756341',
  probe: '2143835551',
};

const TARGET_BID = 1.0;

const RETAINED_KEYWORDS = [
  {
    campaignId: CAMPAIGNS.category,
    keywordId: '2255068522',
    term: 'gift song',
    matchType: 'EXACT',
    rationale: '3 installs, $0.88 CPI over 60d',
  },
  {
    campaignId: CAMPAIGNS.category,
    keywordId: '2264545074',
    term: 'birthday gift ideas',
    matchType: 'EXACT',
    rationale: 'exact-match equivalent for broad winner: 3 installs, $3.68 CPI over 60d',
  },
  {
    campaignId: CAMPAIGNS.category,
    keywordId: '2264546389',
    term: 'birthday gift',
    matchType: 'EXACT',
    rationale: 'exact-match equivalent for broad winner: 1 install, $4.17 CPI over 60d',
  },
  {
    campaignId: CAMPAIGNS.brand,
    keywordId: '2255070694',
    term: 'porizo',
    matchType: 'EXACT',
    rationale: '1 install, $0.27 CPI over 60d',
  },
  {
    campaignId: CAMPAIGNS.discovery,
    keywordId: '2255067569',
    term: 'personalized gift',
    matchType: 'BROAD',
    rationale: '1 install, $0.45 CPI over 60d',
  },
  {
    campaignId: CAMPAIGNS.discovery,
    keywordId: '2259995379',
    term: 'music gift',
    matchType: 'BROAD',
    rationale: '1 install, $1.24 CPI over 60d',
  },
  {
    campaignId: CAMPAIGNS.mothersDay,
    keywordId: '2258612715',
    term: "mother's day song",
    matchType: 'EXACT',
    rationale: '2 installs, $0.08 CPI over 60d; retained at existing sub-$1 bid',
  },
];

function help() {
  console.log(`Usage: node scripts/aso/apply-install-only-actions.mjs [--execute]

Pivots Porizo Apple Ads to install-only protection:
  1. Pause the zero-install Probe campaign.
  2. Disable Search Match in every live ad group.
  3. Keep only install-bearing keywords or exact equivalents of broad winners.
  4. Cap retained keyword and retained ad-group default bids at $${TARGET_BID.toFixed(2)}.
  5. Pause every other active targeting keyword.

Default is dry-run. Pass --execute to mutate Apple Ads.
`);
}

function keywordKey(keyword) {
  return `${keyword.campaignId}:${keyword.id}`;
}

function retainedKey(item) {
  return `${item.campaignId}:${item.keywordId}`;
}

function groupByCampaignAndAdGroup(keywords) {
  const out = new Map();
  for (const keyword of keywords) {
    const key = `${keyword.campaignId}:${keyword.adGroupId}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(keyword);
  }
  return out;
}

async function findCampaigns(client) {
  const json = await client(
    'GET',
    '/campaigns?limit=1000&fields=id,name,status,servingStatus,dailyBudgetAmount,adamId,countriesOrRegions',
  );
  return json.data ?? [];
}

function planKeywordChanges(keywords) {
  const retainById = new Map(RETAINED_KEYWORDS.map((item) => [retainedKey(item), item]));
  const toPause = [];
  const toCap = [];
  const retained = [];
  const missingRetained = new Map(RETAINED_KEYWORDS.map((item) => [retainedKey(item), item]));

  for (const keyword of keywords) {
    const key = keywordKey(keyword);
    const retainedSpec = retainById.get(key);
    if (retainedSpec) {
      missingRetained.delete(key);
      retained.push({ keyword, retainedSpec });
      if (amount(keyword.bidAmount) > TARGET_BID) {
        toCap.push({ keyword, retainedSpec });
      }
      continue;
    }
    if (keyword.status === 'ACTIVE' && !keyword.deleted) {
      toPause.push(keyword);
    }
  }

  return { toPause, toCap, retained, missingRetained: [...missingRetained.values()] };
}

function retainedAdGroupIds(retained) {
  return new Set(retained.map(({ keyword }) => String(keyword.adGroupId)));
}

function planAdGroupChanges(adGroups, retainedAdGroups) {
  const disableSearchMatch = [];
  const capDefaultBid = [];
  const pauseEmpty = [];

  for (const adGroup of adGroups) {
    const hasRetainedKeyword = retainedAdGroups.has(String(adGroup.id));
    if (adGroup.automatedKeywordsOptIn === true) {
      disableSearchMatch.push(adGroup);
    }
    if (hasRetainedKeyword && amount(adGroup.defaultBidAmount) > TARGET_BID) {
      capDefaultBid.push(adGroup);
    }
    if (!hasRetainedKeyword && adGroup.status === 'ENABLED') {
      pauseEmpty.push(adGroup);
    }
  }

  return { disableSearchMatch, capDefaultBid, pauseEmpty };
}

function capKeywordPayloadAtTarget(keyword) {
  return capKeywordPayload(keyword, TARGET_BID);
}

function campaignUpdatePayload(fields) {
  return { campaign: fields };
}

async function updateCampaign(client, campaign, payload, { execute }) {
  if (execute) {
    await client('PUT', `/campaigns/${campaign.id}`, campaignUpdatePayload(payload));
  }
}

async function updateAdGroup(client, adGroup, payload, { execute }) {
  if (execute) {
    await client('PUT', `/campaigns/${adGroup.campaignId}/adgroups/${adGroup.id}`, payload);
  }
}

async function updateKeywordGroups(client, keywordGroups, payloadFor, { execute }) {
  for (const group of keywordGroups.values()) {
    if (!group.length) continue;
    const { campaignId, adGroupId } = group[0];
    const payload = group.map(payloadFor);
    if (execute) {
      await client('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, payload);
    }
  }
}

function printKeyword(keyword) {
  const bid = amount(keyword.bidAmount).toFixed(2);
  return `${keyword.campaignId}/${keyword.adGroupId}/${keyword.id} [${keyword.text}] ${keyword.matchType} ${keyword.status} $${bid}`;
}

async function plan({ client, execute, args }) {
  const campaigns = await findCampaigns(client);
  const managedCampaigns = campaigns.filter((campaign) =>
    Object.values(CAMPAIGNS).includes(String(campaign.id)),
  );

  const adGroups = [];
  const keywords = [];
  for (const campaign of managedCampaigns) {
    adGroups.push(...(await findAdGroups(client, campaign.id)));
    keywords.push(...(await findTargetingKeywords(client, campaign.id)));
  }

  const keywordPlan = planKeywordChanges(keywords);
  const keptAdGroups = retainedAdGroupIds(keywordPlan.retained);
  const adGroupPlan = planAdGroupChanges(adGroups, keptAdGroups);
  const probe = managedCampaigns.find((campaign) => String(campaign.id) === CAMPAIGNS.probe);
  const pauseProbe = probe?.status === 'ENABLED';

  console.log('\nRetained keywords');
  for (const { keyword, retainedSpec } of keywordPlan.retained) {
    const cap = amount(keyword.bidAmount) > TARGET_BID ? ` -> cap to $${TARGET_BID.toFixed(2)}` : '';
    console.log(`  KEEP ${printKeyword(keyword)}${cap} (${retainedSpec.rationale})`);
  }
  for (const missing of keywordPlan.missingRetained) {
    console.log(
      `  MISSING retained keyword ${missing.campaignId}/${missing.keywordId} ` +
        `[${missing.term}] ${missing.matchType}`,
    );
  }

  console.log(`\nKeyword bid caps: ${keywordPlan.toCap.length}`);
  for (const item of keywordPlan.toCap) console.log(`  CAP ${printKeyword(item.keyword)} -> $${TARGET_BID.toFixed(2)}`);

  console.log(`\nKeyword pauses: ${keywordPlan.toPause.length}`);
  for (const keyword of keywordPlan.toPause) console.log(`  PAUSE ${printKeyword(keyword)}`);

  console.log(`\nAd group Search Match disables: ${adGroupPlan.disableSearchMatch.length}`);
  for (const group of adGroupPlan.disableSearchMatch) {
    console.log(`  SEARCH_MATCH_OFF ${group.campaignId}/${group.id} [${group.name}]`);
  }

  console.log(`\nAd group default bid caps: ${adGroupPlan.capDefaultBid.length}`);
  for (const group of adGroupPlan.capDefaultBid) {
    console.log(
      `  CAP_DEFAULT ${group.campaignId}/${group.id} [${group.name}] ` +
        `$${amount(group.defaultBidAmount).toFixed(2)} -> $${TARGET_BID.toFixed(2)}`,
    );
  }

  console.log(`\nEmpty ad group pauses: ${adGroupPlan.pauseEmpty.length}`);
  for (const group of adGroupPlan.pauseEmpty) {
    console.log(`  PAUSE_ADGROUP ${group.campaignId}/${group.id} [${group.name}]`);
  }

  console.log(`\nCampaign pauses: ${pauseProbe ? 1 : 0}`);
  if (pauseProbe) console.log(`  PAUSE_CAMPAIGN ${probe.id} [${probe.name}]`);

  if (keywordPlan.missingRetained.length) {
    throw new Error('Refusing to execute with missing retained keyword IDs');
  }

  if (!execute) {
    console.log(DRY_RUN_TRAILER);
    return;
  }

  if (pauseProbe) await updateCampaign(client, probe, { status: 'PAUSED' }, args);

  for (const group of adGroupPlan.disableSearchMatch) {
    await updateAdGroup(client, group, { automatedKeywordsOptIn: false }, args);
  }
  for (const group of adGroupPlan.capDefaultBid) {
    await updateAdGroup(
      client,
      group,
      {
        defaultBidAmount: {
          amount: TARGET_BID.toFixed(2),
          currency: group.defaultBidAmount?.currency ?? 'USD',
        },
      },
      args,
    );
  }
  for (const group of adGroupPlan.pauseEmpty) {
    await updateAdGroup(client, group, { status: 'PAUSED' }, args);
  }

  await updateKeywordGroups(client, groupByCampaignAndAdGroup(keywordPlan.toCap.map((item) => item.keyword)), capKeywordPayloadAtTarget, args);
  await updateKeywordGroups(client, groupByCampaignAndAdGroup(keywordPlan.toPause), pauseKeywordPayload, args);

  console.log('\nApplied Apple Ads install-only pivot.');
}

runApplyMain({
  executeBanner: 'EXECUTING Apple Ads install-only pivot',
  dryRunBanner: 'Dry-run Apple Ads install-only pivot',
  plan,
  help,
}).catch(applyMainErrorHandler('apply-install-only-actions'));
