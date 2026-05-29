#!/usr/bin/env node
/**
 * Meta Ads analyzer — orchestrator.
 *   node -r dotenv/config scripts/ads/run.mjs [--campaign <id>]
 *
 * pull → store snapshot → evaluate (rules) → narrate (LLM) → Markdown report + HTML dashboard.
 * Recommend-only: never changes the account. Suggestions include the exact command to apply.
 *
 * Token: ~/meta-ads/.env (ACCESS_TOKEN). LLM: ANTHROPIC_API_KEY from repo .env (dotenv/config).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadCreds, pullCampaign } from './pull.mjs';
import { appendSnapshot, seriesForAd } from './store.mjs';
import { evaluateEntity, abcVerdict, trendFlags, DEFAULT_THRESHOLDS } from './evaluate.mjs';
import { narrate } from './narrate.mjs';
import { renderMarkdown, writeReport } from './report.mjs';
import { renderDashboard, writeDashboard } from './dashboard.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const cfg = JSON.parse(readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const T = { ...DEFAULT_THRESHOLDS, ...cfg.thresholds };

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i !== -1 ? process.argv[i + 1] : d;
};
const CAMPAIGN = arg('--campaign', '52503493410610');

/** Build recommend-only actions with exact commands. */
function buildRecommendations(ev) {
  const recs = [];
  const tok = '$ACCESS_TOKEN';
  const pauseCmd = (id) =>
    `curl -s -X POST "https://graph.facebook.com/v23.0/${id}" --data-urlencode "access_token=${tok}" --data-urlencode "status=PAUSED"`;
  const budgetCmd = (id, aud) =>
    `curl -s -X POST "https://graph.facebook.com/v23.0/${id}" --data-urlencode "access_token=${tok}" --data-urlencode "daily_budget=${Math.round(aud * 100)}"`;

  // Learning gate — if the campaign rollup is still learning, hold everything.
  const camp = ev.campaignRollup;
  const learning =
    !camp || camp.installs < T.learningInstallFloor || ev.campaign.ageDays < T.learningMinAgeDays;
  if (learning) {
    const need = Math.max(0, T.learningInstallFloor - (camp?.installs || 0));
    recs.push({
      action: 'HOLD',
      target: ev.campaign.name,
      reason: `Still in learning phase (${camp?.installs || 0} installs, ${ev.campaign.ageDays}d old). Need ~${need} more installs before A/B/C or scale/pause calls are trustworthy. Let it run.`,
      command: null,
    });
    return recs;
  }

  // Past learning → act on significance + per-ad verdicts.
  if (ev.abc.conclusive) {
    const leader = ev.entities.find((e) => e.metrics.id === ev.abc.leaderId);
    recs.push({
      action: 'SCALE',
      target: leader?.metrics.name || ev.abc.leaderId,
      reason: `${ev.abc.reason} Shift budget toward the winner (e.g. raise campaign daily budget).`,
      command: budgetCmd(ev.campaign.id, (ev.campaign.dailyBudget || 20) * 2),
    });
    for (const id of ev.abc.laggardIds) {
      const e = ev.entities.find((x) => x.metrics.id === id);
      recs.push({
        action: 'PAUSE',
        target: e?.metrics.name || id,
        reason: `Laggard vs ${ev.abc.leaderId} past the significance floor — stop funding it.`,
        command: pauseCmd(id),
      });
    }
  }

  for (const e of ev.entities) {
    if (e.verdict === 'REFRESH') {
      recs.push({
        action: 'REFRESH',
        target: e.metrics.name,
        reason: `Frequency ${e.metrics.frequency?.toFixed(1)} / CTR decay — creative fatigue. Generate a fresh variant (new config in generate-ad-templates.js) and rotate it in.`,
        command: 'node marketing/tools/generate-ad-templates.js  # edit config, then upload + new ad',
      });
    } else if (e.verdict === 'PAUSE' && !ev.abc.laggardIds.includes(e.metrics.id)) {
      recs.push({
        action: 'PAUSE',
        target: e.metrics.name,
        reason: `CPI ${e.metrics.cpi?.toFixed(2)} is >${T.cpiWarnMultiple}× target (A$${T.targetCpi}) past learning. Cut it.`,
        command: pauseCmd(e.metrics.id),
      });
    }
    if (e.flags.pacing === 'under') {
      recs.push({
        action: 'INVESTIGATE',
        target: e.metrics.name,
        reason: `Under-delivering (spend well below budget). Audience too narrow, bid too low, or in review. Check delivery diagnostics.`,
        command: null,
      });
    }
  }
  return recs;
}

(async () => {
  const { token } = await loadCreds();
  console.log(`Pulling ${CAMPAIGN} …`);
  const pull = await pullCampaign({ token, campaignId: CAMPAIGN, windows: cfg.windows });
  const history = await appendSnapshot(pull);

  const max = (level) => pull.rows.find((r) => r.level === level && r.window === 'maximum' && !r.error);
  const campaignRollup = max('campaign');
  const adRows = pull.rows.filter((r) => r.level === 'ad' && r.window === 'maximum' && !r.error);

  const entities = adRows.map((m) => evaluateEntity(m, T));
  const abc = abcVerdict(
    adRows.map((r) => ({ id: r.id, installs: r.installs, cpi: r.cpi })),
    T,
  );
  const trends = adRows.map((r) => ({
    id: r.id,
    name: r.name,
    ...trendFlags(seriesForAd(history, r.id), T),
  }));

  const ev = {
    pulledAt: pull.pulledAt,
    campaign: pull.campaign,
    campaignRollup,
    entities,
    abc,
    trends,
    thresholds: T,
  };
  ev.recommendations = buildRecommendations(ev);

  let narrative = null;
  try {
    narrative = await narrate(ev);
  } catch (e) {
    console.warn(`narrate skipped: ${e.message}`);
  }

  const md = renderMarkdown(ev, narrative);
  const reportFile = await writeReport(md, pull.pulledAt);
  const dashFile = await writeDashboard(renderDashboard(history, pull.campaign));

  console.log(`\n${'─'.repeat(60)}`);
  console.log(md);
  console.log('─'.repeat(60));
  console.log(`\nReport:    ${reportFile}`);
  console.log(`Dashboard: ${dashFile}`);
})().catch((e) => {
  console.error('run failed:', e.message);
  process.exit(1);
});
