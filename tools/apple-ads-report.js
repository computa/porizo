#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const DEFAULT_CREDENTIALS_PATH =
  process.env.APPLE_ADS_CREDENTIALS_PATH ||
  path.join(
    os.homedir(),
    "Documents/projects/business/acuoos/apple-ads-keys/Porizo-Ads/apple_ads_credentials.env",
  );
const TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
const API_BASE_URL = "https://api.searchads.apple.com/api/v5";

function parseArgs(argv) {
  const args = {
    credentials: DEFAULT_CREDENTIALS_PATH,
    days: 7,
    endDate: null,
    startDate: null,
    orgId: null,
    json: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--credentials") args.credentials = argv[++i];
    else if (arg === "--days") args.days = Number(argv[++i]);
    else if (arg === "--start") args.startDate = argv[++i];
    else if (arg === "--end") args.endDate = argv[++i];
    else if (arg === "--org") args.orgId = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help") {
      console.log(`Usage: node tools/apple-ads-report.js [--days 7] [--start YYYY-MM-DD --end YYYY-MM-DD] [--org ORG_ID] [--json]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parseEnvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function requireValue(values, key) {
  const value = values[key];
  if (!value) {
    throw new Error(`Missing ${key} in credentials file.`);
  }
  return value;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(args) {
  if (args.startDate && args.endDate) {
    return { startTime: args.startDate, endTime: args.endDate };
  }

  const days = Number.isFinite(args.days) ? Math.max(1, Math.trunc(args.days)) : 7;
  const end = args.endDate ? new Date(`${args.endDate}T00:00:00Z`) : new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { startTime: ymd(start), endTime: ymd(end) };
}

function createClientSecret({ clientId, teamId, keyId, privateKey }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: teamId,
    iat: issuedAt,
    exp: issuedAt + 60 * 60,
    aud: "https://appleid.apple.com",
    sub: clientId,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: {
      alg: "ES256",
      kid: keyId,
    },
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.error_description || body?.raw || response.statusText;
    const error = new Error(`${response.status} ${response.statusText}: ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function requestAccessToken({ clientId, clientSecret }) {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "searchadsorg",
  });

  const body = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!body?.access_token) {
    throw new Error("Apple did not return an access token.");
  }
  return body.access_token;
}

function authHeaders(accessToken, orgId = null) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
  if (orgId !== null && orgId !== undefined && orgId !== "") {
    headers["X-AP-Context"] = `orgId=${orgId}`;
  }
  return headers;
}

async function appleAdsGet(accessToken, resource, orgId = null) {
  return await fetchJson(`${API_BASE_URL}${resource}`, {
    method: "GET",
    headers: authHeaders(accessToken, orgId),
  });
}

async function appleAdsPost(accessToken, resource, orgId, payload) {
  return await fetchJson(`${API_BASE_URL}${resource}`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken, orgId),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function pickOrgId(acls, explicitOrgId) {
  if (explicitOrgId) return explicitOrgId;
  const rows = Array.isArray(acls?.data) ? acls.data : [];
  const first = rows.find((row) => row?.orgId || row?.organizationId || row?.id);
  const orgId = first?.orgId || first?.organizationId || first?.id;
  if (!orgId) {
    throw new Error("Could not infer Apple Ads orgId from ACL response.");
  }
  return String(orgId);
}

function moneyValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value === "object") return Number(value.amount ?? value.value ?? 0) || 0;
  return 0;
}

function summarizeReport(report) {
  const rows = Array.isArray(report?.data?.reportingDataResponse?.row)
    ? report.data.reportingDataResponse.row
    : (Array.isArray(report?.data?.row) ? report.data.row : []);
  const grandTotalsEnvelope = report?.data?.reportingDataResponse?.grandTotals || report?.data?.grandTotals || null;
  const grandTotals = grandTotalsEnvelope?.total || grandTotalsEnvelope || null;

  return rows.map((entry) => {
    const metadata = entry.metadata || {};
    const total = entry.total || {};
    const spend = total.localSpend || total.spend || total.totalSpend || null;
    return {
      campaignId: metadata.campaignId || metadata.id || entry.campaignId || entry.id || null,
      campaignName: metadata.campaignName || metadata.name || entry.campaignName || entry.name || null,
      impressions: Number(total.impressions || 0),
      taps: Number(total.taps || 0),
      installs: Number(total.totalInstalls || total.installs || 0),
      tapInstalls: Number(total.tapInstalls || 0),
      viewInstalls: Number(total.viewInstalls || 0),
      newDownloads: Number(total.totalNewDownloads || total.newDownloads || 0),
      redownloads: Number(total.totalRedownloads || total.redownloads || 0),
      spend: moneyValue(spend),
      currency: spend?.currency || total.currency || null,
    };
  }).concat(grandTotals ? [{
    campaignId: "TOTAL",
    campaignName: "Grand Total",
    impressions: Number(grandTotals.impressions || 0),
    taps: Number(grandTotals.taps || 0),
    installs: Number(grandTotals.totalInstalls || grandTotals.installs || 0),
    tapInstalls: Number(grandTotals.tapInstalls || 0),
    viewInstalls: Number(grandTotals.viewInstalls || 0),
    newDownloads: Number(grandTotals.totalNewDownloads || grandTotals.newDownloads || 0),
    redownloads: Number(grandTotals.totalRedownloads || grandTotals.redownloads || 0),
    spend: moneyValue(grandTotals.localSpend || grandTotals.spend || grandTotals.totalSpend),
    currency: grandTotals.localSpend?.currency || grandTotals.currency || null,
  }] : []);
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log("No campaign report rows returned for this date range.");
    return;
  }

  const printable = rows.map((row) => ({
    campaign: row.campaignName || row.campaignId || "--",
    impressions: row.impressions,
    taps: row.taps,
    installs: row.installs,
    tapInstalls: row.tapInstalls,
    viewInstalls: row.viewInstalls,
    newDownloads: row.newDownloads,
    spend: row.currency ? `${row.spend.toFixed(2)} ${row.currency}` : row.spend.toFixed(2),
    cpi: row.installs > 0 ? (row.spend / row.installs).toFixed(2) : "--",
  }));
  console.table(printable);
}

async function main() {
  const args = parseArgs(process.argv);
  const credentialsPath = path.resolve(args.credentials);
  const credentials = parseEnvFile(credentialsPath);

  const clientId = requireValue(credentials, "APPLE_ADS_CLIENT_ID");
  const teamId = requireValue(credentials, "APPLE_ADS_TEAM_ID");
  const keyId = requireValue(credentials, "APPLE_ADS_KEY_ID");
  const privateKeyPath = requireValue(credentials, "APPLE_ADS_PRIVATE_KEY_PATH");
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");

  const clientSecret = createClientSecret({ clientId, teamId, keyId, privateKey });
  const accessToken = await requestAccessToken({ clientId, clientSecret });
  const acls = await appleAdsGet(accessToken, "/acls");
  const orgId = pickOrgId(acls, args.orgId);
  const me = await appleAdsGet(accessToken, "/me", orgId);
  const campaigns = await appleAdsGet(accessToken, "/campaigns?limit=1000", orgId);
  const { startTime, endTime } = dateRange(args);
  const report = await appleAdsPost(accessToken, "/reports/campaigns", orgId, {
    startTime,
    endTime,
    selector: {
      orderBy: [
        {
          field: "campaignId",
          sortOrder: "ASCENDING",
        },
      ],
      pagination: {
        offset: 0,
        limit: 1000,
      },
    },
    timeZone: "UTC",
    returnRecordsWithNoMetrics: true,
    returnRowTotals: true,
    returnGrandTotals: true,
  });

  const result = {
    orgId,
    userId: me?.data?.userId || null,
    parentOrgId: me?.data?.parentOrgId || null,
    startTime,
    endTime,
    aclCount: Array.isArray(acls?.data) ? acls.data.length : null,
    campaignCount: Array.isArray(campaigns?.data) ? campaigns.data.length : null,
    campaigns: campaigns?.data || [],
    reportRows: summarizeReport(report),
    rawReport: report,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Apple Ads orgId: ${result.orgId}`);
  console.log(`API userId: ${result.userId || "--"}`);
  console.log(`Date range: ${startTime} to ${endTime} UTC`);
  console.log(`Campaigns visible: ${result.campaignCount ?? "--"}`);
  printTable(result.reportRows);
}

main().catch((error) => {
  console.error(error.message);
  if (error.body) {
    console.error(JSON.stringify(error.body, null, 2));
  }
  process.exit(1);
});
