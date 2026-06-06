import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { asaJson, getAccessToken, readAsaEnv } from './spend-pull.mjs';
import { normalizeTerm } from './rerank-core.mjs';

// Single source of truth for term normalization — re-exported from rerank-core.
export { normalizeTerm };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArgs(argv) {
  const args = { execute: false, help: false };
  for (const arg of argv) {
    if (arg === '--execute') args.execute = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

export async function loadEnvFile(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }
}

export function selector({ limit = 1000 } = {}) {
  return {
    pagination: { offset: 0, limit },
    orderBy: [{ field: 'id', sortOrder: 'ASCENDING' }],
    conditions: [{ field: 'deleted', operator: 'EQUALS', values: ['false'] }],
  };
}

export function normalizeMatchType(matchType) {
  return String(matchType ?? '').toUpperCase();
}

// NOTE: this is NOT rerank-core's parseNumber. parseNumber strips [$,%] but does
// NOT coerce ASA money objects ({ amount, currency }); these scripts call
// amount(keyword.bidAmount) on those objects, so the object branch is load-bearing.
// Keeping amount here preserves byte-identical money coercion.
export function amount(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  if (typeof value === 'object' && value.amount != null) return Number(value.amount) || 0;
  return 0;
}

export function groupByAdGroup(keywords) {
  const map = new Map();
  for (const keyword of keywords) {
    const id = String(keyword.adGroupId);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(keyword);
  }
  return map;
}

export function keywordKey(keyword) {
  return `${normalizeTerm(keyword.text)}::${normalizeMatchType(keyword.matchType)}`;
}

export function createKeywordPayload(term, bid, currency = 'USD') {
  return {
    text: term,
    matchType: 'EXACT',
    bidAmount: { amount: bid.toFixed(2), currency },
  };
}

export function pauseKeywordPayload(keyword) {
  return {
    id: Number(keyword.id),
    status: 'PAUSED',
    bidAmount: keyword.bidAmount,
  };
}

export function capKeywordPayload(keyword, targetBid) {
  return {
    id: Number(keyword.id),
    bidAmount: {
      amount: targetBid.toFixed(2),
      currency: keyword.bidAmount?.currency ?? 'USD',
    },
  };
}

export async function findTargetingKeywords(client, campaignId) {
  const json = await client('POST', `/campaigns/${campaignId}/adgroups/targetingkeywords/find`, selector());
  return json.data ?? [];
}

export async function findAdGroups(client, campaignId) {
  const json = await client('POST', `/campaigns/${campaignId}/adgroups/find`, selector());
  return json.data ?? [];
}

export async function findCampaignNegatives(client, campaignId) {
  const json = await client('POST', `/campaigns/${campaignId}/negativekeywords/find`, selector());
  return json.data ?? [];
}

// Unified campaign-negative creator. Two call forms produce byte-identical
// payloads to the original per-script implementations:
//   - Tuple form  (defaultMatchType == null): terms are [term, matchType] pairs;
//     payload text is normalizeTerm(term), matchType is normalizeMatchType(matchType).
//   - Bare form   (defaultMatchType set):      terms are bare strings; payload text
//     is the RAW term (unnormalized), matchType is the fixed defaultMatchType.
export async function createCampaignNegatives(client, campaignId, terms, { execute, defaultMatchType = null } = {}) {
  const existing = await findCampaignNegatives(client, campaignId);
  const existingKeys = new Set(existing.map((kw) => keywordKey(kw)));
  let payload;
  if (defaultMatchType == null) {
    payload = terms
      .map(([term, matchType]) => [normalizeTerm(term), normalizeMatchType(matchType)])
      .filter(([term, matchType]) => !existingKeys.has(`${term}::${matchType}`))
      .map(([term, matchType]) => ({ text: term, matchType }));
  } else {
    payload = terms
      .filter((term) => !existingKeys.has(`${normalizeTerm(term)}::${defaultMatchType}`))
      .map((term) => ({ text: term, matchType: defaultMatchType }));
  }
  if (execute && payload.length) {
    await client('POST', `/campaigns/${campaignId}/negativekeywords/bulk`, payload);
  }
  return { campaignId, existing: existing.length, created: payload };
}

export const DRY_RUN_TRAILER = '\nDry-run only. Re-run with --execute to apply these Apple Ads changes.';

// Identical main() prologue shared by all three apply scripts:
//   parseArgs -> (help) -> loadEnvFile(.env) -> readAsaEnv -> getAccessToken ->
//   client closure -> execute/dry-run banner -> plan({ client, execute, args, cfg }).
//
// The banner text differs per script (the install-only pivot prints no emoji),
// so it is passed verbatim via `executeBanner` / `dryRunBanner` rather than
// templated — byte-for-byte output is preserved.
//
// The dry-run trailer is NOT printed here: install-only prints it mid-main with
// an early return before its mutation block, while the other two print it last.
// Each `plan` owns its own trailer via DRY_RUN_TRAILER to keep flow identical.
export async function runApplyMain({ executeBanner, dryRunBanner, plan, help }) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    if (help) help();
    return;
  }

  await loadEnvFile(path.join(ROOT, '.env'));
  const cfg = readAsaEnv();
  const token = await getAccessToken(cfg);
  const client = (method, urlPath, body = null) =>
    asaJson({ token, orgId: cfg.orgId, method, urlPath, body });

  console.log(args.execute ? executeBanner : dryRunBanner);

  await plan({ client, execute: args.execute, args, cfg });
}

// Identical trailing error handler: log a script-labelled message, optionally
// dump the stack under DEBUG, exit 1. `prefix` is the full leading text
// ("✖ apply-painkiller-actions" or, for the install-only pivot, the plain
// "apply-install-only-actions" with no glyph) so each script's stderr is
// byte-identical. Returns a handler for `runApplyMain(...).catch(...)`.
export function applyMainErrorHandler(prefix) {
  return (err) => {
    console.error(`${prefix} failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  };
}
