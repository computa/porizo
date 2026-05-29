/**
 * Pull Meta Insights for a campaign at campaign + ad level, across windows.
 * Token comes from ~/meta-ads/.env (ACCESS_TOKEN, AD_ACCOUNT_ID) — same creds
 * the `meta` CLI uses. Network via Node fetch (not curl — avoids the Bash hook).
 *
 * Returns normalized rows the evaluator understands.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GRAPH = 'https://graph.facebook.com/v23.0';

const INSIGHT_FIELDS = [
  'impressions', 'reach', 'frequency', 'spend', 'clicks',
  'inline_link_clicks', 'inline_link_click_ctr', 'cpm', 'cpc',
  'actions', 'cost_per_action_type',
  'ad_id', 'ad_name', 'adset_id', 'campaign_id', 'date_start', 'date_stop',
].join(',');

const INSTALL_ACTION_TYPES = ['omni_app_install', 'mobile_app_install', 'app_install'];

/** Read ACCESS_TOKEN + AD_ACCOUNT_ID from an env file (default ~/meta-ads/.env). */
export async function loadCreds(envPath = path.join(os.homedir(), 'meta-ads', '.env')) {
  const raw = await fs.readFile(envPath, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!env.ACCESS_TOKEN) throw new Error(`ACCESS_TOKEN not found in ${envPath}`);
  return { token: env.ACCESS_TOKEN, account: env.AD_ACCOUNT_ID };
}

/** Sum app installs from an actions[] array (prefer omni, avoid double-count). */
export function extractInstalls(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const type of INSTALL_ACTION_TYPES) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

/** Normalize a raw insights row → evaluator metric shape. */
export function normalizeRow(row, { level, window, ageDays, dailyBudget }) {
  const spend = Number(row.spend) || 0;
  const installs = extractInstalls(row.actions);
  const linkClicks = Number(row.inline_link_clicks) || 0;
  const impressions = Number(row.impressions) || 0;
  const linkCtr = Number(row.inline_link_click_ctr)
    ? Number(row.inline_link_click_ctr) / 100 // Meta returns CTR as a percent
    : impressions > 0
      ? linkClicks / impressions
      : null;
  return {
    level,
    window,
    id: row.ad_id || row.campaign_id,
    name: row.ad_name || `campaign:${row.campaign_id}`,
    campaignId: row.campaign_id,
    adsetId: row.adset_id || null,
    impressions,
    reach: Number(row.reach) || 0,
    frequency: Number(row.frequency) || null,
    spend,
    clicks: Number(row.clicks) || 0,
    linkClicks,
    linkCtr,
    cpm: Number(row.cpm) || null,
    cpc: Number(row.cpc) || null,
    installs,
    cpi: installs > 0 ? spend / installs : null,
    ageDays,
    dailyBudget,
    dateStart: row.date_start,
    dateStop: row.date_stop,
  };
}

async function graphGet(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Graph API: ${json.error.message} (code ${json.error.code})`);
  return json;
}

/** Whole-day age of a campaign from its created_time. */
function ageDaysFrom(createdTime, now = Date.now()) {
  if (!createdTime) return 0;
  return Math.max(0, Math.floor((now - new Date(createdTime).getTime()) / 86400000));
}

/**
 * Pull campaign meta (created_time, budget) + campaign-level and ad-level
 * insights for each window. Returns { campaign, rows, pulledAt }.
 */
export async function pullCampaign({ token, campaignId, windows, nowMs }) {
  const meta = await graphGet(
    `${GRAPH}/${campaignId}?fields=name,created_time,daily_budget,effective_status&access_token=${token}`,
  );
  const ageDays = ageDaysFrom(meta.created_time, nowMs ?? Date.now());
  const dailyBudget = meta.daily_budget ? Number(meta.daily_budget) / 100 : null;

  const rows = [];
  for (const window of windows) {
    for (const level of ['campaign', 'ad']) {
      const url = `${GRAPH}/${campaignId}/insights?level=${level}&fields=${INSIGHT_FIELDS}&date_preset=${window}&access_token=${token}`;
      let json;
      try {
        json = await graphGet(url);
      } catch (e) {
        rows.push({ level, window, error: String(e.message) });
        continue;
      }
      for (const r of json.data || []) {
        rows.push(normalizeRow(r, { level, window, ageDays, dailyBudget }));
      }
    }
  }

  return {
    pulledAt: new Date(nowMs ?? Date.now()).toISOString(),
    campaign: {
      id: campaignId,
      name: meta.name,
      status: meta.effective_status,
      createdTime: meta.created_time,
      ageDays,
      dailyBudget,
    },
    rows,
  };
}
