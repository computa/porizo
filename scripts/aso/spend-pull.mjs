import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

const APPLE_ID_TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
const ASA_BASE = 'https://api.searchads.apple.com/api/v5';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signClientAssertion({ clientId, teamId, keyId, privateKeyPem, ttlSec = 600 }) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: teamId,
    sub: clientId,
    aud: 'https://appleid.apple.com',
    iat: now,
    exp: now + ttlSec,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;
  const sig = crypto.createSign('SHA256').update(message).sign({
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${message}.${base64url(sig)}`;
}

export async function getAccessToken({ clientId, teamId, keyId, privateKeyPath }) {
  const privateKeyPem = await fs.readFile(privateKeyPath, 'utf8');
  const assertion = signClientAssertion({ clientId, teamId, keyId, privateKeyPem });
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: assertion,
    scope: 'searchadsorg',
  });
  const res = await fetch(APPLE_ID_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ASA token exchange failed ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.access_token;
}

export async function asaJson({ token, orgId, urlPath, method = 'GET', body = null }) {
  const res = await fetch(`${ASA_BASE}${urlPath}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-AP-Context': `orgId=${orgId}`,
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ASA ${method} ${urlPath} failed ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

async function asaReport({ token, orgId, urlPath, body }) {
  return asaJson({ token, orgId, urlPath, method: 'POST', body });
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function reportBody({ startTime, endTime, orderByField }) {
  return {
    startTime,
    endTime,
    selector: {
      orderBy: [{ field: orderByField, sortOrder: 'DESCENDING' }],
      pagination: { offset: 0, limit: 1000 },
    },
    granularity: 'DAILY',
    timeZone: 'UTC',
    returnRowTotals: false,
    returnGrandTotals: false,
    returnRecordsWithNoMetrics: false,
  };
}

function moneyAmount(m) {
  if (m == null) return 0;
  if (typeof m === 'number') return m;
  if (typeof m === 'string') return Number(m) || 0;
  if (typeof m === 'object' && m.amount != null) return Number(m.amount) || 0;
  return 0;
}

function optionalMoneyAmount(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = moneyAmount(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function normalizeCampaignRows(json) {
  const rows = json?.data?.reportingDataResponse?.row ?? [];
  const out = [];
  for (const row of rows) {
    const meta = row.metadata ?? {};
    for (const g of row.granularity ?? []) {
      out.push({
        campaign_id: String(meta.campaignId),
        name: meta.campaignName,
        date: g.date,
        impressions: g.impressions ?? 0,
        taps: g.taps ?? 0,
        installs: g.installs ?? g.totalInstalls ?? 0,
        spend: moneyAmount(g.localSpend ?? g.spend),
        avg_cpt: moneyAmount(g.avgCPT),
      });
    }
  }
  return out;
}

function normalizeKeywordRows(json, campaignId) {
  const rows = json?.data?.reportingDataResponse?.row ?? [];
  const out = [];
  for (const row of rows) {
    const meta = row.metadata ?? {};
    for (const g of row.granularity ?? []) {
      out.push({
        campaign_id: String(campaignId),
        keyword_id: String(meta.keywordId),
        term: meta.keyword ?? meta.keywordText,
        match_type: meta.matchType ?? 'UNKNOWN',
        max_cpt: optionalMoneyAmount(meta.bidAmount, meta.maxCPT, meta.maxCpt),
        date: g.date,
        impressions: g.impressions ?? 0,
        taps: g.taps ?? 0,
        installs: g.installs ?? g.totalInstalls ?? 0,
        spend: moneyAmount(g.localSpend ?? g.spend),
        avg_cpt: moneyAmount(g.avgCPT),
      });
    }
  }
  return out;
}

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function readAsaEnv(env = process.env) {
  return {
    orgId: env.PORIZO_ASA_ORG_ID || envOrThrow('PORIZO_ASA_ORG_ID'),
    clientId: env.PORIZO_ASA_CLIENT_ID || envOrThrow('PORIZO_ASA_CLIENT_ID'),
    teamId: env.PORIZO_ASA_TEAM_ID || envOrThrow('PORIZO_ASA_TEAM_ID'),
    keyId: env.PORIZO_ASA_KEY_ID || envOrThrow('PORIZO_ASA_KEY_ID'),
    privateKeyPath: env.PORIZO_ASA_PRIVATE_KEY_PATH || envOrThrow('PORIZO_ASA_PRIVATE_KEY_PATH'),
  };
}

export async function pullDailySpend({ days = 30, env = process.env, log = () => {} } = {}) {
  const cfg = readAsaEnv(env);
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const startTime = ymd(start);
  const endTime = ymd(end);

  log(`Auth: requesting ASA access token`);
  const token = await getAccessToken(cfg);

  log(`Fetch: /reports/campaigns ${startTime}..${endTime}`);
  const campaignsJson = await asaReport({
    token,
    orgId: cfg.orgId,
    urlPath: '/reports/campaigns',
    body: reportBody({ startTime, endTime, orderByField: 'campaignId' }),
  });
  const campaignRows = normalizeCampaignRows(campaignsJson);

  const campaignIds = [...new Set(campaignRows.map((r) => r.campaign_id))];
  log(`Found ${campaignIds.length} campaigns with activity`);

  const keywordRows = [];
  for (const cid of campaignIds) {
    log(`Fetch: /reports/campaigns/${cid}/keywords`);
    try {
      const kwJson = await asaReport({
        token,
        orgId: cfg.orgId,
        urlPath: `/reports/campaigns/${cid}/keywords`,
        body: reportBody({ startTime, endTime, orderByField: 'keywordId' }),
      });
      keywordRows.push(...normalizeKeywordRows(kwJson, cid));
    } catch (err) {
      log(`  ⚠ Skipped campaign ${cid}: ${err.message}`);
    }
  }

  return {
    pulled_at: new Date().toISOString(),
    window: { startTime, endTime, days },
    campaigns: campaignRows,
    keywords: keywordRows,
  };
}
